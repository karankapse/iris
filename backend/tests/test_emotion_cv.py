from app.services.emotion_trainer import evaluate_model


def test_evaluate_model_returns_none_for_insufficient_data():
    assert evaluate_model([]) is None

    # 1 sample -> no CV possible
    samples = [{"feature_names": ["a"], "label": "happy", "features": [1.0]}]
    assert evaluate_model(samples) is None

    # 1 of each class -> minimum needed is 2 of each class
    samples = [
        {"feature_names": ["a"], "label": "happy", "features": [1.0]},
        {"feature_names": ["a"], "label": "sad", "features": [0.0]},
    ]
    assert evaluate_model(samples) is None


def test_evaluate_model_computes_accuracy():
    # Make a perfect fake dataset: 5 happy, 5 sad, completely separable
    samples = []
    for i in range(5):
        samples.append({"feature_names": ["f1"], "label": "happy", "features": [10.0 + i]})
        samples.append({"feature_names": ["f1"], "label": "sad", "features": [0.0 + i]})

    accuracy = evaluate_model(samples)
    assert accuracy is not None
    assert 0.0 <= accuracy <= 1.0
    # Since it's perfectly separable, accuracy should be high
    assert accuracy > 0.8
